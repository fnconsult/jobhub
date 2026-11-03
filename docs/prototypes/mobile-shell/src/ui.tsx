// PROTOTYPE (throwaway, branch prototype/mobile-shell). Shared pieces of the shell: no tests, no polish.
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tokens, type, useTheme } from "./theme";

const useNative = Platform.OS !== "web";
export const duration = tokens.motion.duration;

// ——— Small pieces ———

export function T({ children, size = "body", color, weight, style }: {
  children: ReactNode; size?: "body" | "meta" | "lead" | "h3" | "h2"; color?: string; weight?: "400" | "500" | "600" | "700"; style?: object;
}) {
  const { c } = useTheme();
  const fontSize = size === "meta" ? type.metaFontSize : type.fontSize[size];
  return (
    <Text style={[{ fontSize, lineHeight: Math.round(fontSize * (size === "h2" || size === "h3" ? 1.25 : type.lineHeight)), color: color ?? c.text, fontWeight: weight ?? "400" }, style]}>
      {children}
    </Text>
  );
}

export function Btn({ label, onPress, kind = "secondary", small, icon, a11y }: {
  label?: string; onPress: () => void; kind?: "primary" | "secondary" | "ghost"; small?: boolean; icon?: string; a11y?: string;
}) {
  const { c } = useTheme();
  const bg = kind === "primary" ? c.accent : kind === "secondary" ? c.surface : "transparent";
  const fg = kind === "primary" ? c.onAccent : c.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: small ? 36 : type.controlHeight + 4,
        minWidth: 44,
        paddingHorizontal: label ? 14 : 10,
        borderRadius: tokens.radius.control,
        backgroundColor: pressed ? c.hover : bg,
        borderWidth: kind === "secondary" ? StyleSheet.hairlineWidth : 0,
        borderColor: c.borderStrong,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
      })}
    >
      {icon ? <Text style={{ fontSize: 18, color: fg }}>{icon}</Text> : null}
      {label ? <Text style={{ fontSize: small ? 14 : 15, fontWeight: "600", color: fg }}>{label}</Text> : null}
    </Pressable>
  );
}

export function Pill({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "accent" | "success" | "warn" | "danger" }) {
  const { c } = useTheme();
  const map = {
    neutral: [c.surface, c.secondary],
    accent: [c.accentSoft, c.accent],
    success: [c.successSoft, c.success],
    warn: [c.warnSoft, c.warn],
    danger: [c.dangerSoft, c.danger],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: fg }} />
      <Text style={{ fontSize: 13, fontWeight: "600", color: fg }}>{label}</Text>
    </View>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, borderRadius: tokens.radius.card, backgroundColor: c.canvas, overflow: "hidden", marginVertical: 8 }}>
      {title ? (
        <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6 }}>
          <T size="meta" color={c.meta} weight="600">{title.toUpperCase()}</T>
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Row({ title, sub, right, onPress }: { title: string; sub?: string; right?: ReactNode; onPress?: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: type.rowPadding, minHeight: 52, backgroundColor: pressed ? c.hover : "transparent", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border })}
    >
      <View style={{ flex: 1 }}>
        <T weight="500">{title}</T>
        {sub ? <T size="meta" color={c.secondary}>{sub}</T> : null}
      </View>
      {right}
      {onPress ? <Text style={{ color: c.meta, fontSize: 18 }}>›</Text> : null}
    </Pressable>
  );
}

// ——— Top bar ———

export function TopBar({ left, title, onTitlePress, right }: { left?: ReactNode; title: string; onTitlePress?: () => void; right?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ minHeight: 56, flexDirection: "row", alignItems: "center", paddingHorizontal: 8, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border, backgroundColor: c.background }}>
      <View style={{ flexDirection: "row", minWidth: 44 }}>{left}</View>
      <Pressable accessibilityRole="header" onPress={onTitlePress} disabled={!onTitlePress} style={{ flex: 1, paddingHorizontal: 6 }}>
        <Text numberOfLines={1} style={{ fontSize: 17, fontWeight: "600", color: c.text, textAlign: "center" }}>
          {onTitlePress ? "‹ " : ""}{title}
        </Text>
      </Pressable>
      <View style={{ flexDirection: "row", minWidth: 44, justifyContent: "flex-end", gap: 4 }}>{right}</View>
    </View>
  );
}

// ——— Conversation ———

export type Msg = { from: "me" | "coach"; text: string };

export function Conversation({ intro, card, messages, streaming, onSend, onStop, suggestions, readingWidth, above }: {
  intro: string; card?: ReactNode; above?: ReactNode; messages: Msg[]; streaming: boolean; onSend: (t: string) => void; onStop: () => void; suggestions: string[]; readingWidth: number;
}) {
  const { c } = useTheme();
  const scroll = useRef<ScrollViewInstance>(null);
  const [draft, setDraft] = useState("");
  const [plusOpen, setPlusOpen] = useState(false);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    scroll.current?.scrollToEnd({ animated: true });
  }, [messages]);
  const send = (t: string) => {
    if (!t.trim() || streaming) return;
    onSend(t.trim());
    setDraft("");
  };
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScrollView ref={scroll} contentContainerStyle={{ paddingVertical: 16, paddingHorizontal: 16, alignItems: "center" }}>
        <View style={{ width: "100%", maxWidth: readingWidth }}>
          <View style={{ flexDirection: "row", gap: 10, marginBottom: 6 }}>
            <Glyph />
            <T color={c.secondary} style={{ flex: 1 }}>{intro}</T>
          </View>
          {card}
          {messages.map((m, i) =>
            m.from === "me" ? (
              <View key={i} style={{ alignSelf: "flex-end", maxWidth: "85%", backgroundColor: c.surface, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, marginVertical: 8 }}>
                <T>{m.text}</T>
              </View>
            ) : (
              <View key={i} style={{ flexDirection: "row", gap: 10, marginVertical: 8 }}>
                <Glyph />
                <View style={{ flex: 1 }}>
                  <T>{m.text}{streaming && i === messages.length - 1 ? " ▍" : ""}</T>
                  {!(streaming && i === messages.length - 1) ? (
                    <T size="meta" color={c.meta} style={{ marginTop: 6 }}>Cela répond à votre question ?  Oui · Non</T>
                  ) : null}
                </View>
              </View>
            ),
          )}
        </View>
      </ScrollView>
      <View style={{ alignItems: "center", paddingHorizontal: 12, paddingBottom: Math.max(8, insets.bottom ? 0 : 8) }}>
        <View style={{ width: "100%", maxWidth: readingWidth }}>
          {above}
          {messages.length === 0 && suggestions.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 8 }}>
              {suggestions.map((s) => (
                <Btn key={s} small label={s} onPress={() => send(s)} />
              ))}
            </ScrollView>
          ) : null}
          {plusOpen ? (
            <View style={{ flexDirection: "row", gap: 8, paddingBottom: 8, flexWrap: "wrap" }}>
              <Btn small icon="🔗" label="Coller un lien d'offre" onPress={() => setPlusOpen(false)} />
              <Btn small icon="📄" label="Joindre un CV (PDF, DOCX)" onPress={() => setPlusOpen(false)} />
            </View>
          ) : null}
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 24, backgroundColor: c.canvas, padding: 6 }}>
            <Btn kind="ghost" icon="+" a11y="Joindre" onPress={() => setPlusOpen((v) => !v)} />
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Écrire au coach…"
              placeholderTextColor={c.meta}
              multiline
              onSubmitEditing={() => send(draft)}
              style={{ flex: 1, fontSize: 16, color: c.text, paddingVertical: 10, maxHeight: 140, ...(Platform.OS === "web" ? { outlineStyle: "none" } : {}) } as object}
            />
            {streaming ? (
              <Btn kind="secondary" icon="■" a11y="Arrêter" onPress={onStop} />
            ) : (
              <Btn kind="primary" icon="↑" a11y="Envoyer" onPress={() => send(draft)} />
            )}
          </View>
          <T size="meta" color={c.meta} style={{ textAlign: "center", marginTop: 6 }}>Coach IA · Signaler un problème</T>
        </View>
      </View>
    </View>
  );
}

function Glyph() {
  const { c } = useTheme();
  return (
    <View style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: c.accentSoft, alignItems: "center", justifyContent: "center", marginTop: 2 }}>
      <Text style={{ fontSize: 13, fontWeight: "700", color: c.accent }}>J</Text>
    </View>
  );
}

// ——— Sheet with two detents (phone) ———

const DETENTS = [0.55, 0.92];

export function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const { c } = useTheme();
  const { height } = useWindowDimensions();
  const [detent, setDetent] = useState(0);
  const y = useRef(new Animated.Value(height)).current;
  const start = useRef(0);
  const top = (d: number) => height * (1 - DETENTS[d]);
  const animate = (to: number, done?: () => void) =>
    Animated.timing(y, { toValue: to, duration: duration.slow, easing: Easing.out(Easing.cubic), useNativeDriver: useNative }).start(done);

  useEffect(() => {
    if (open) setDetent(0);
    animate(open ? top(0) : height);
  }, [open, height]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
        onPanResponderGrant: () => y.stopAnimation((v) => (start.current = v)),
        onPanResponderMove: (_, g) => y.setValue(Math.max(top(1), start.current + g.dy)),
        onPanResponderRelease: (_, g) => {
          const v = start.current + g.dy;
          if (v > height * 0.72) return onClose();
          const d = Math.abs(v - top(0)) < Math.abs(v - top(1)) ? 0 : 1;
          setDetent(d);
          animate(top(d));
        },
      }),
    [height, onClose],
  );

  const go = (d: number) => {
    setDetent(d);
    animate(top(d));
  };

  return (
    <View pointerEvents={open ? "auto" : "none"} style={StyleSheet.absoluteFill}>
      {open ? <Pressable accessibilityLabel="Fermer" onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }]} /> : null}
      <Animated.View
        accessibilityViewIsModal
        style={{ position: "absolute", left: 0, right: 0, top: 0, height: height * DETENTS[1], transform: [{ translateY: y }], backgroundColor: c.background, borderTopLeftRadius: 16, borderTopRightRadius: 16, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 24, elevation: 12 }}
      >
        <View {...pan.panHandlers} style={{ paddingTop: 8, paddingBottom: 4, paddingHorizontal: 8 }}>
          <View style={{ alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: c.borderStrong, marginBottom: 6 }} />
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Btn kind="ghost" small label={detent === 0 ? "Agrandir" : "Réduire"} onPress={() => go(detent === 0 ? 1 : 0)} />
            <Text style={{ flex: 1, textAlign: "center", fontSize: 17, fontWeight: "600", color: c.text }}>{title}</Text>
            <Btn kind="ghost" small label="✕ Fermer" onPress={onClose} />
          </View>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 16 + height * (DETENTS[1] - DETENTS[detent]) }}>{children}</ScrollView>
      </Animated.View>
    </View>
  );
}

// ——— Drawer over the page (phone, or a wide screen with no room) ———

export function Drawer({ open, onClose, width, children }: { open: boolean; onClose: () => void; width: number; children: ReactNode }) {
  const { c } = useTheme();
  const x = useRef(new Animated.Value(-width)).current;
  useEffect(() => {
    Animated.timing(x, { toValue: open ? 0 : -width, duration: duration.base, easing: Easing.out(Easing.cubic), useNativeDriver: useNative }).start();
  }, [open, width]);
  return (
    <View pointerEvents={open ? "auto" : "none"} style={StyleSheet.absoluteFill}>
      {open ? <Pressable accessibilityLabel="Fermer le menu" onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }]} /> : null}
      <Animated.View accessibilityViewIsModal style={{ position: "absolute", top: 0, bottom: 0, left: 0, width, transform: [{ translateX: x }], backgroundColor: c.nav, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 20, elevation: 12 }}>
        {children}
      </Animated.View>
    </View>
  );
}
